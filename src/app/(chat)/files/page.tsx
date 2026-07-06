import { getSession } from "auth/server";
import { getIsUserAdmin } from "lib/user/utils";
import { redirect } from "next/navigation";
import { DriveExplorer } from "@/components/files/drive-explorer";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session?.user) return redirect("/login");
  return (
    <div className="h-dvh">
      <DriveExplorer isAdmin={getIsUserAdmin(session.user)} />
    </div>
  );
}
