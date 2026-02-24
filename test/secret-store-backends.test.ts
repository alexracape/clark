import { describe, expect, test } from "bun:test";
import {
  LinuxLibsecretStore,
  WindowsCredentialStore,
  createSecretStore,
} from "../src/config.ts";

type ExecCall = {
  file: string;
  args: readonly string[];
  options?: { input?: string };
};

function makeExecMock(
  responder?: (file: string, args: readonly string[], options?: { input?: string }) => Promise<{ stdout: string; stderr: string }> | { stdout: string; stderr: string },
) {
  const calls: ExecCall[] = [];

  const exec = async (file: string, args: readonly string[], options?: { input?: string }) => {
    calls.push({ file, args, options });
    if (!responder) return { stdout: "", stderr: "" };
    return await responder(file, args, options);
  };

  return { exec, calls };
}

describe("LinuxLibsecretStore", () => {
  test("get uses secret-tool lookup and trims returned value", async () => {
    const { exec, calls } = makeExecMock(async () => ({ stdout: "linux-key\n", stderr: "" }));
    const store = new LinuxLibsecretStore(exec);

    const value = await store.get("openai");

    expect(value).toBe("linux-key");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      file: "secret-tool",
      args: ["lookup", "service", "com.clark.api-keys", "account", "openai"],
      options: undefined,
    });
  });

  test("set uses secret-tool store with stdin input", async () => {
    const { exec, calls } = makeExecMock();
    const store = new LinuxLibsecretStore(exec);

    await store.set("anthropic", "linux-secret");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      file: "secret-tool",
      args: [
        "store",
        "--label",
        "Clark API key for anthropic",
        "service",
        "com.clark.api-keys",
        "account",
        "anthropic",
      ],
      options: { input: "linux-secret" },
    });
  });

  test("delete uses secret-tool clear and swallows command errors", async () => {
    const { exec, calls } = makeExecMock(async () => {
      throw new Error("not found");
    });
    const store = new LinuxLibsecretStore(exec);

    await expect(store.delete("gemini")).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      file: "secret-tool",
      args: ["clear", "service", "com.clark.api-keys", "account", "gemini"],
      options: undefined,
    });
  });
});

describe("WindowsCredentialStore", () => {
  test("get uses PowerShell lookup and trims returned value", async () => {
    const { exec, calls } = makeExecMock(async () => ({ stdout: "win-key\r\n", stderr: "" }));
    const store = new WindowsCredentialStore(exec);

    const value = await store.get("openai");

    expect(value).toBe("win-key");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("powershell");
    expect(calls[0]?.args[0]).toBe("-NoProfile");
    expect(calls[0]?.args[1]).toBe("-Command");
    expect(calls[0]?.args[2]).toContain("com.clark.api-keys:openai");
  });

  test("set uses cmdkey generic credentials", async () => {
    const { exec, calls } = makeExecMock();
    const store = new WindowsCredentialStore(exec);

    await store.set("anthropic", "win-secret");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      file: "cmdkey",
      args: [
        "/generic:com.clark.api-keys:anthropic",
        "/user:anthropic",
        "/pass:win-secret",
      ],
      options: undefined,
    });
  });

  test("delete uses cmdkey /delete and swallows command errors", async () => {
    const { exec, calls } = makeExecMock(async () => {
      throw new Error("not found");
    });
    const store = new WindowsCredentialStore(exec);

    await expect(store.delete("gemini")).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      file: "cmdkey",
      args: ["/delete:com.clark.api-keys:gemini"],
      options: undefined,
    });
  });
});

describe("createSecretStore", () => {
  test("selects linux backend on linux when no preference is set", () => {
    const store = createSecretStore({}, "linux");
    expect(store.backend).toBe("linux-libsecret");
  });

  test("selects windows backend on win32 when no preference is set", () => {
    const store = createSecretStore({}, "win32");
    expect(store.backend).toBe("windows-credential");
  });

  test("falls back when preferred backend does not match platform", () => {
    const store = createSecretStore({ secretStoreBackend: "windows-credential" }, "linux");
    expect(store.backend).toBe("fallback");
  });

  test("falls back when explicitly requested", () => {
    const store = createSecretStore({ secretStoreBackend: "fallback" }, "linux");
    expect(store.backend).toBe("fallback");
  });
});
