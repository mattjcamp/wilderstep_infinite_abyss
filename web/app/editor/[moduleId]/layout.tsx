import { Sidebar } from "@/editor/Sidebar";

export async function generateStaticParams() {
  // Hardcoded for now — will read from data/modules/index.json once the
  // module index generator script lands.
  return [{ moduleId: "default" }];
}

export default function ModuleEditorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { moduleId: string };
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar moduleId={params.moduleId} />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
