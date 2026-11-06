import { notFound } from "next/navigation";
import { GaitAnnotationTool } from "@/components/development/gait-annotation-tool";

export default function GaitAnnotationPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GaitAnnotationTool />;
}
