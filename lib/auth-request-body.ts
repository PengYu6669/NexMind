export async function readAuthRequestBody(req: Request): Promise<Record<string, string | boolean | undefined>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await req.json().catch(() => ({}))) as Record<string, string | boolean | undefined>;
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await req.formData();
    return {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      password2: String(form.get("password2") ?? ""),
      name: String(form.get("name") ?? ""),
      remember: form.get("remember") ? "on" : undefined,
    };
  }
  return {};
}
