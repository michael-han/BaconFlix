import pino from "pino";

export function createLogger(level = "info") {
    const pretty = process.env.NODE_ENV !== "production";
    return pino({
        level,
        transport: pretty
            ? {
                  target: "pino-pretty",
                  options: { translateTime: "SYS:standard", ignore: "pid,hostname" },
              }
            : undefined,
    });
}
