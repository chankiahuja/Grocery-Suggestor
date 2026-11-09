import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const windows = process.platform === "win32";
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

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
