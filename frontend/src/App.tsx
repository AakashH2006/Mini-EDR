import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import { WebSocketProvider } from "./lib/ws";
import ActivityExplorer from "./pages/ActivityExplorer";
import Alerts from "./pages/Alerts";
import Investigations from "./pages/Investigations";
import IncidentDetail from "./pages/IncidentDetail";
import Processes from "./pages/Processes";
import NetworkPage from "./pages/NetworkPage";
import Timeline from "./pages/Timeline";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <WebSocketProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<ActivityExplorer />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/investigations" element={<Investigations />} />
            <Route path="/investigations/:id" element={<IncidentDetail />} />
            <Route path="/processes" element={<Processes />} />
            <Route path="/network" element={<NetworkPage />} />
            <Route path="/timeline" element={<Timeline />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </WebSocketProvider>
  );
}
