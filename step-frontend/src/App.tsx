import { Sidebar } from "@/components/Sidebar";
import { StepViewer } from "@/components/StepViewer";
import "./App.css";

export default function App() {
  return (
    <main className="app-shell">
      <Sidebar />

      <section className="viewer-panel">
        <StepViewer />
      </section>
    </main>
  );
}
