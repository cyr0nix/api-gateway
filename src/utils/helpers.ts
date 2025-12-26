import { v4 as uuidv4 } from "uuid";

export const generateRequestId = (): string => uuidv4();

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const parseBoolean = (value: string | undefined): boolean => {
  if (!value) return false;
  return ["true", "1", "yes"].includes(value.toLowerCase());
};

export const maskSensitiveData = (obj: Record<string, unknown>): Record<string, unknown> => {
  const sensitiveKeys = ["password", "token", "secret", "authorization"];
  const masked = { ...obj };

  for (const key of Object.keys(masked)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      masked[key] = "***";
    }
  }

  return masked;
};
