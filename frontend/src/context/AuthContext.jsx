import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, getToken, setToken } from '../api';
import { initSocket, disconnectSocket, subscribeSocket } from '../socket';

const AuthContext = createContext(null);

export const DEMO_PERSONAS = [
  {
    role: 'admin',
    name: 'Alex Morgan',
    email: 'admin@meridian.demo',
    title: 'General Manager',
    color: '#f26b3a',
    password: 'meridian123',
    desc: 'Full dealership access: Financial KPIs, staff users, GDPR requests & audit logs',
  },
  {
    role: 'sales',
    name: 'Sarah Mitchell',
    email: 'sarah@meridian.demo',
    title: 'Senior Sales Rep',
    color: '#6366f1',
    password: 'meridian123',
    desc: 'Sales pipeline: CRM Kanban, Test drives, Deals desking, customer chats',
  },
  {
    role: 'sales',
    name: 'Marcus Reed',
    email: 'marcus@meridian.demo',
    title: 'Sales Specialist',
    color: '#14b8a6',
    password: 'meridian123',
    desc: 'Sales rep handling inventory quotes, follow-up automation, and customer WhatsApp',
  },
  {
    role: 'service',
    name: 'Diego Alvarez',
    email: 'diego@meridian.demo',
    title: 'Service Advisor',
    color: '#eab308',
    password: 'meridian123',
    desc: 'Aftersales ops: Repair Orders, workshop bays, parts catalog & stock levels',
  },
  {
    role: 'customer',
    name: 'Emma Clarke',
    email: 'customer@meridian.demo',
    title: 'Portal Customer',
    color: '#f43f5e',
    password: 'customer123',
    desc: 'Customer portal: My garage, live service RO tracker, test-drive booking, consent privacy',
  },
];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [onlineStaff, setOnlineStaff] = useState([]);
  const [notifications, setNotifications] = useState([]);

  // Fetch current user from /auth/me on mount
  useEffect(() => {
    async function loadUser() {
      const token = getToken();
      if (!token) {
        // Default to admin demo login for seamless first evaluation
        try {
          await quickLogin('admin@meridian.demo');
        } catch (e) {
          setLoading(false);
        }
        return;
      }
      try {
        const u = await api.get('/auth/me');
        setUser(u);
        initSocket();
      } catch (err) {
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    loadUser();

    const handleUnauthorized = () => {
      setToken(null);
      setUser(null);
      disconnectSocket();
    };
    window.addEventListener('meridian:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('meridian:unauthorized', handleUnauthorized);
  }, []);

  // Subscribe to realtime socket events for notifications and presence
  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeSocket((event, data) => {
      if (event === 'presence') {
        setOnlineStaff(Array.isArray(data) ? data : []);
      } else {
        // Push notification toast
        const id = Date.now() + Math.random();
        let message = `Event: ${event}`;
        if (event === 'lead.created') message = `New lead created for ${data.customer_name || 'customer'}`;
        else if (event === 'lead.moved') message = `Lead moved to ${data.lead?.stage || 'new stage'}`;
        else if (event === 'inventory.created') message = `New vehicle added: ${data.title}`;
        else if (event === 'test_drive.created') message = `Test drive scheduled: ${data.vehicle_title || 'unit'}`;
        else if (event === 'deal.status') message = `Deal ${data.deal_number} marked as ${data.status}`;
        else if (event === 'communication.created') message = `${data.channel?.toUpperCase()} message: ${data.direction}`;
        else if (event === 'service.updated') message = `RO ${data.ro_number} updated to ${data.status}`;

        setNotifications((prev) => [
          { id, event, message, timestamp: new Date(), data },
          ...prev.slice(0, 19),
        ]);
      }
    });

    return () => unsubscribe();
  }, [user]);

  async function login(email, password) {
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      setToken(res.access_token);
      const me = await api.get('/auth/me');
      setUser(me);
      initSocket();
      return me;
    } finally {
      setLoading(false);
    }
  }

  async function quickLogin(email) {
    const persona = DEMO_PERSONAS.find((p) => p.email === email);
    if (!persona) return;
    return login(persona.email, persona.password);
  }

  async function register(data) {
    setLoading(true);
    try {
      const res = await api.post('/auth/register', data);
      setToken(res.access_token);
      const me = await api.get('/auth/me');
      setUser(me);
      initSocket();
      return me;
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setToken(null);
    setUser(null);
    disconnectSocket();
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        onlineStaff,
        notifications,
        clearNotifications: () => setNotifications([]),
        login,
        quickLogin,
        register,
        logout,
        isStaff: user && ['admin', 'sales', 'service'].includes(user.role),
        isAdmin: user?.role === 'admin',
        isSales: user && ['admin', 'sales'].includes(user.role),
        isService: user && ['admin', 'service'].includes(user.role),
        isCustomer: user?.role === 'customer',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
