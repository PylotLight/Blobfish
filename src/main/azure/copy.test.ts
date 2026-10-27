import { beforeEach, describe, expect, mock, test } from "bun:test";

interface FakeBlob {
  name: string;
  properties?: { contentLength?: number };
}

interface CopyCall {
  source: string;
  destination: string;
}

let blobs: FakeBlob[] = [];
let copyCalls: CopyCall[] = [];
let markerUploads: string[] = [];
let deletes: string[] = [];
let copyImpl: (source: string, destination: string) => Promise<unknown>;
let deleteImpl: (name: string) => Promise<void>;
let client: ReturnType<typeof makeClient>;

function makeClient() {
  return {
    getBlobClient(name: string) {
      return { url: `https://storage.example.test/container/${name}` };
    },
    getBlockBlobClient(name: string) {
      return {
        beginCopyFromURL(source: string) {
          copyCalls.push({ source, destination: name });
          return {
            pollUntilDone: () => copyImpl(source, name),
          };
        },
        async uploadData(_data: Uint8Array) {
          markerUploads.push(name);
        },
      };
    },
    async *listBlobsFlat(options: { prefix: string }) {
      for (const blob of blobs) {
        if (blob.name.startsWith(options.prefix)) yield blob;
      }
    },
    async deleteBlob(name: string) {
      deletes.push(name);
      await deleteImpl(name);
    },
  };
}

mock.module("../accounts", () => ({
  decryptSecret: async () => ({
    profile: { endpoint: "https://storage.example.test" },
    secret: "AccountName=test;AccountKey=key",
  }),
}));
mock.module("../activity", () => ({ logActivity: () => undefined }));
mock.module("../azure-clients", () => ({
  blobContainerClientFromSecret: () => client,
  isDfsEndpoint: () => false,
}));
mock.module("./common", () => ({ withSas: (url: string) => url }));
mock.module("./errors", () => ({
  friendlyError: (err: unknown) =>
    err instanceof Error ? err : new Error(String(err)),
}));

const { copyBlobs, moveBlobs } = await import("./copy");

beforeEach(() => {
  blobs = [];
  copyCalls = [];
  markerUploads = [];
  deletes = [];
  copyImpl = async () => ({ copyStatus: "success" });
  deleteImpl = async () => undefined;
  client = makeClient();
});

describe("Azure blob copy and move", () => {
  test("uses a polled server-side copy and preserves nested empty folders", async () => {
    blobs = [
      { name: "source/" },
      { name: "source/report.csv", properties: { contentLength: 20 } },
      { name: "source/empty/" },
    ];

    const count = await copyBlobs(
      "account",
      "container",
      ["source/"],
      "backup",
    );

    expect(count).toBe(2);
    expect(copyCalls).toEqual([
      {
        source: "https://storage.example.test/container/source/report.csv",
        destination: "backup/report.csv",
      },
    ]);
    expect(markerUploads).toEqual(["backup/empty/"]);
  });

  test("waits for the asynchronous copy to complete before deleting move sources", async () => {
    let releaseCopy!: () => void;
    let startedCopy!: () => void;
    const started = new Promise<void>((resolve) => {
      startedCopy = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseCopy = resolve;
    });
    copyImpl = async () => {
      startedCopy();
      await blocked;
      return { copyStatus: "success" };
    };

    const move = moveBlobs("account", "container", ["source.txt"], "target");
    await started;
    expect(deletes).toEqual([]);
    releaseCopy();
    await move;

    expect(deletes).toEqual(["source.txt"]);
  });

  test("waits for in-flight copies and stops assigning queued work after a failure", async () => {
    let releaseActive!: () => void;
    let allActiveStarted!: () => void;
    const activeStarted = new Promise<void>((resolve) => {
      allActiveStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    let activeCount = 0;
    copyImpl = async (_source, destination) => {
      if (destination === "target/a.txt")
        throw new Error("simulated copy failure");
      activeCount += 1;
      if (activeCount === 7) allActiveStarted();
      await blocked;
      return { copyStatus: "success" };
    };

    const names = "abcdefghi".split("").map((letter) => `${letter}.txt`);
    const result = copyBlobs("account", "container", names, "target").then(
      () => null,
      (err: unknown) => err,
    );
    await activeStarted;
    expect(copyCalls).toHaveLength(8);
    const settledBeforeRelease = await Promise.race([
      result.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0)),
    ]);
    expect(settledBeforeRelease).toBe(false);

    releaseActive();
    const error = await result;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("simulated copy failure");
    expect(copyCalls).toHaveLength(8);
  });

  test("waits for all source deletions and identifies a partial move", async () => {
    let releaseDelete!: () => void;
    let secondDeleteStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      secondDeleteStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    deleteImpl = async (name) => {
      if (name === "first.txt") throw new Error("source delete denied");
      secondDeleteStarted();
      await blocked;
    };

    const move = moveBlobs(
      "account",
      "container",
      ["first.txt", "second.txt"],
      "target",
    ).then(
      () => null,
      (err: unknown) => err,
    );
    await started;
    expect(deletes).toHaveLength(2);
    const settledBeforeRelease = await Promise.race([
      move.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0)),
    ]);
    expect(settledBeforeRelease).toBe(false);

    releaseDelete();
    const error = await move;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("move is partial");
  });

  test("explains source and destination permissions on Azure authentication failures", async () => {
    copyImpl = async () => {
      throw new Error(
        "Server failed to authenticate the request. RequestId: test-request",
      );
    };

    const error = await copyBlobs(
      "account",
      "container",
      ["source.txt"],
      "target",
    ).catch((err: unknown) => err);

    expect((error as Error).message).toContain("read (r) and write (w)");
    expect((error as Error).message).toContain("delete (d)");
    expect((error as Error).message).toContain("test-request");
  });
});
