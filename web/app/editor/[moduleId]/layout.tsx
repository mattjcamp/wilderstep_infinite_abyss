import { decodeModuleIdParam, encodeModuleId } from "@/editor/moduleRoutes";
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
  const moduleId = decodeModuleIdParam(params.moduleId);
  return (
    // h-screen (not min-h-screen) bounds the editor shell to the
    // viewport so the content area scrolls INSIDE itself rather than
    // growing the page. That's what lets a tall map's canvas viewport
    // produce its own vertical scrollbar / pan instead of the whole
    // body scrolling. overflow-hidden on the row keeps the shell put;
    // the sidebar + content each manage their own overflow.
    <div className="flex h-screen overflow-hidden">
      <Sidebar moduleId={moduleId} />
      <div className="min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
