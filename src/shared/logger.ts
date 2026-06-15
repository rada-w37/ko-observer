export const logger = {
  debug(message: string): void {
    console.log(`[DEBUG] ${message}`);
  },

  info(message: string): void {
    console.log(`[INFO] ${message}`);
  },

  warn(message: string): void {
    console.warn(`[WARN] ${message}`);
  },

  error(message: string, error: unknown): void {
    console.error(`[ERROR] ${message}`);

    if (error instanceof Error) {
      console.error(error.message);
      return;
    }

    console.error(error);
  },
};
