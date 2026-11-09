import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const windows = process.platform === "win32";
const envPath = fileURLToPath(new URL("../.env", import.meta.url));

const parseDotEnv = (filePath) => {
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue;

    if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      const quote = rawValue[0];
      if (rawValue.endsWith(quote)) {
        value = rawValue.slice(1, -1);
        if (quote === '"') {
          value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        }
      }
    } else {
      value = rawValue.replace(/\s+#.*$/, "").trim();
    }

    process.env[key] = value;
  }
};

if (existsSync(envPath)) parseDotEnv(envPath);

const server = spawn(
  windows ? "mvnw.cmd" : "sh",
  windows ? ["spring-boot:run"] : ["./mvnw", "spring-boot:run"],
  {
    cwd: fileURLToPath(new URL("../backend/", import.meta.url)),
    stdio: "inherit",
    shell: windows,
  },
);
server.on("error", (error) => {
  console.error(`Could not start Spring Boot: ${error.message}`);
  process.exitCode = 1;
});
server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
