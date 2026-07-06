import { getSession } from "auth/server";
import { redirect } from "next/navigation";
import { DriveExplorer } from "@/components/files/drive-explorer";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session?.user) return redirect("/login");
  return (
    <div className="h-dvh">
      <DriveExplorer />
    </div>
  );
}
