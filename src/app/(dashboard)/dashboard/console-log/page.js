import { redirect } from "next/navigation";

export default function ConsoleLogPage() {
  redirect("/dashboard/usage?tab=console");
}
