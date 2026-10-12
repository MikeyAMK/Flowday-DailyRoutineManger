import { redirect } from "next/navigation";
import { FlowdayDashboard } from "@/components/flowday-dashboard";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function ProtectedPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) redirect("/auth/login");

  return <FlowdayDashboard />;
}
