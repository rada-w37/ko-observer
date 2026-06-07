export type AppConfig = {
  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
  mode: KooMode;
  runId: string;
  worldId?: string;
  ownGuildName?: string;
};

export type KooMode = "phase0-smoke-test" | "phase1-scope-test";

const REQUIRED_ENV_KEYS = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = loadMode(env.KOO_MODE);
  const missingKeys: string[] = REQUIRED_ENV_KEYS.filter((envKey) => !env[envKey]);

  if (mode === "phase1-scope-test" && !env.KOO_WORLD_ID) {
    missingKeys.push("KOO_WORLD_ID");
  }

  if (missingKeys.length > 0) {
    throw new Error(`Missing required environment variables: ${missingKeys.join(", ")}`);
  }

  return {
    firebaseProjectId: env.FIREBASE_PROJECT_ID as string,
    firebaseClientEmail: env.FIREBASE_CLIENT_EMAIL as string,
    firebasePrivateKey: restorePrivateKey(env.FIREBASE_PRIVATE_KEY as string),
    mode,
    runId: env.GITHUB_RUN_ID ?? "local",
    worldId: env.KOO_WORLD_ID,
    ownGuildName: env.KOO_OWN_GUILD_NAME,
  };
}

function loadMode(mode: string | undefined): KooMode {
  if (!mode) {
    return "phase0-smoke-test";
  }

  if (mode === "phase0-smoke-test" || mode === "phase1-scope-test") {
    return mode;
  }

  throw new Error(`Unsupported KOO_MODE: ${mode}`);
}

function restorePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n");
}
