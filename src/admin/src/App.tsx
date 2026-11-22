import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout';
import { Login, Dashboard, NewDeployment, DeploymentDetail, DeploymentHistory, Credentials } from './pages';
import { api } from './lib/api';

function ProtectedApp() {
  if (!api.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/deployments/new" element={<NewDeployment />} />
        <Route path="/deployments/:id" element={<DeploymentDetail />} />
        <Route path="/deployments" element={<DeploymentHistory />} />
        <Route path="/credentials" element={<Credentials />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<ProtectedApp />} />
    </Routes>
  );
}

export default App;
