const prefix = "[auteur]";

export const log = {
  info(message: string): void {
    console.log(`${prefix} ${message}`);
  },
  warn(message: string): void {
    console.warn(`${prefix} warning: ${message}`);
  },
  error(message: string): void {
    console.error(`${prefix} error: ${message}`);
  },
  step(message: string): void {
    console.log(`\n${prefix} ${message}`);
  },
  table(rows: Array<Record<string, unknown>>): void {
    if (rows.length === 0) return;
    console.table(rows);
  },
};
