export type AppConfig = {
  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
  runId: string;
};

const REQUIRED_ENV_KEYS = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const missingKeys = REQUIRED_ENV_KEYS.filter((envKey) => !env[envKey]);

  if (missingKeys.length > 0) {
    throw new Error(`Missing required environment variables: ${missingKeys.join(", ")}`);
  }

  return {
    firebaseProjectId: env.FIREBASE_PROJECT_ID as string,
    firebaseClientEmail: env.FIREBASE_CLIENT_EMAIL as string,
    firebasePrivateKey: restorePrivateKey(env.FIREBASE_PRIVATE_KEY as string),
    runId: env.GITHUB_RUN_ID ?? "local",
  };
}

function restorePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n");
}
