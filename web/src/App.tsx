import { Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";

// "/" is reserved for the landing page (later); until then it forwards to the dashboard.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
