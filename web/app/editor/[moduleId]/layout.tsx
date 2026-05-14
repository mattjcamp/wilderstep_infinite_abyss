import { Sidebar } from "@/editor/Sidebar";
import { listModuleIds } from "@/data_model/moduleIndex";

export async function generateStaticParams() {
  const ids = await listModuleIds();
  return ids.map((moduleId) => ({ moduleId }));
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
