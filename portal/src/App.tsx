import { Route, Routes } from "react-router-dom";

import ImagePage from "@/app/image/page";
import AppShell from "@/app/layout";
import LoginPage from "@/app/login/page";
import HomePage from "@/app/page";
import RegisterPage from "@/app/register/page";
import UsersPage from "@/app/users/page";
import { RequirePortalAdmin, RequirePortalAuth } from "@/components/portal-route";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/workspace"
          element={
            <RequirePortalAuth>
              <ImagePage />
            </RequirePortalAuth>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequirePortalAdmin>
              <UsersPage />
            </RequirePortalAdmin>
          }
        />
      </Routes>
    </AppShell>
  );
}
