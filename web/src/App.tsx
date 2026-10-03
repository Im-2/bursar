import { Navigate, Route, Routes } from "react-router-dom";
import { WalletModal } from "./components/WalletModal";
import Landing from "./landing/Landing";
import Dashboard from "./pages/Dashboard";
import Playground from "./pages/Playground";

// "/" is the landing page; unknown paths forward to it.
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/try" element={<Playground />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <WalletModal />
    </>
  );
}
