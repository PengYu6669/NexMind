export function verifyInternalCron(req: Request): boolean {
  const token = process.env.INTERNAL_CRON_TOKEN?.trim();
  if (!token) return false;
  const auth = req.headers.get("authorization")?.trim();
  return auth === `Bearer ${token}`;
}

export function internalCronAuthError() {
  return {
    error: process.env.INTERNAL_CRON_TOKEN ? "未授权" : "服务未配置 INTERNAL_CRON_TOKEN",
    status: process.env.INTERNAL_CRON_TOKEN ? 401 : 503,
  };
}
