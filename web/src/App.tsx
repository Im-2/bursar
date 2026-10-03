import { Navigate, Route, Routes } from "react-router-dom";
import { WalletModal } from "./components/WalletModal";
import Dashboard from "./pages/Dashboard";
import Playground from "./pages/Playground";

// "/" is reserved for the landing page (later); until then it forwards to the dashboard.
export default function App() {
  return (
    <>
        <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/try" element={<Playground />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <WalletModal />
    </>
  );
}
