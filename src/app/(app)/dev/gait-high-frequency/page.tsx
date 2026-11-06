import { notFound } from "next/navigation";
import { GaitHighFrequencyTool } from "@/components/development/gait-high-frequency-tool";

export const dynamic = "force-dynamic";

export default function GaitHighFrequencyPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GaitHighFrequencyTool />;
}
