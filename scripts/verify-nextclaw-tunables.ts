import "dotenv/config";
import { NEXTCLAW_TUNABLES } from "@/lib/nextclaw-agent-config";

async function main() {
  console.log(
    JSON.stringify(
      {
        ok: true,
        tunables: NEXTCLAW_TUNABLES,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
