import React, { useState, useEffect, useRef } from 'react';
import { api, formatDate, formatDateTime } from '../api';
import { useAuth } from '../context/AuthContext';
import { subscribeSocket } from '../socket';
import { 
  MessageSquare, Mail, Send, Check, CheckCheck, Clock, 
  Sparkles, Bot, Phone, RefreshCw, User
} from 'lucide-react';

export default function CommsView() {
  const { user } = useAuth();
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  // Reply composer
  const [replyText, setReplyText] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [simulating, setSimulating] = useState(false);

  const messagesEndRef = useRef(null);

  async function loadThreads() {
    try {
      const res = await api.get('/communications/threads');
      setThreads(res || []);
      if (!selectedThread && res?.[0]) {
        setSelectedThread(res[0]);
      }
    } catch (e) {
      console.error('Failed to load threads:', e);
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages(customerId) {
    if (!customerId) return;
    try {
      const res = await api.get(`/communications?customer_id=${customerId}&limit=100`);
      setMessages((res || []).reverse());
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  }

  async function loadTemplates() {
    try {
      const res = await api.get('/communications/templates');
      setTemplates(res || []);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    loadThreads();
    loadTemplates();
  }, []);

  useEffect(() => {
    if (selectedThread) {
      loadMessages(selectedThread.customer_id);
      setChannel(selectedThread.preferred_channel || 'whatsapp');
    }
  }, [selectedThread]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Realtime updates
  useEffect(() => {
    const unsubscribe = subscribeSocket((event, data) => {
      if (event === 'communication.created') {
        if (selectedThread && data.customer_id === selectedThread.customer_id) {
          setMessages((prev) => [...prev, data]);
        }
        loadThreads();
      }
    });
    return () => unsubscribe();
  }, [selectedThread]);

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!replyText.trim() || !selectedThread) return;
    try {
      const res = await api.post('/communications/send', {
        customer_id: selectedThread.customer_id,
        channel: channel,
        body: replyText,
      });
      setReplyText('');
      setMessages((prev) => [...prev, res]);
      loadThreads();
    } catch (err) {
      alert(`Failed to send message: ${err.message}`);
    }
  }

  async function handleApplyTemplate(templateKey) {
    if (!templateKey || !selectedThread) return;
    try {
      const preview = await api.post('/communications/preview', {
        customer_id: selectedThread.customer_id,
        channel: channel,
        template: templateKey,
      });
      setReplyText(preview.body || '');
      setSelectedTemplate(templateKey);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleSimulateInbound() {
    if (!selectedThread) return;
    try {
      setSimulating(true);
      // Calls the Node realtime dev webhook on port 4000
      await fetch('http://127.0.0.1:4000/dev/whatsapp/inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: '+1 512 555 0198',
          body: 'Thanks for the quick quote! Can I bring my current car for an appraisal this Saturday morning?',
        }),
      });
      setTimeout(() => {
        setSimulating(false);
        loadMessages(selectedThread.customer_id);
      }, 1000);
    } catch (err) {
      setSimulating(false);
      alert(`Simulation failed: ${err.message}`);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800 }}>Omnichannel Customer Inbox</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Meta WhatsApp Cloud API queue &bull; Transactional SMTP email &bull; GDPR consent verification
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            id="btn-simulate-inbound"
            className="btn btn-secondary"
            onClick={handleSimulateInbound}
            disabled={simulating}
          >
            <Bot size={15} color="#34d399" />
            <span>{simulating ? 'Simulating...' : 'Simulate Customer WhatsApp Reply'}</span>
          </button>
        </div>
      </div>

      {/* Main Inbox Container */}
      <div className="glass-panel" style={{ height: 'calc(100vh - 200px)', display: 'flex', overflow: 'hidden' }}>
        {/* Left Thread List */}
        <div style={{
          width: '320px',
          borderRight: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary)',
        }}>
          <div style={{ padding: '14px', borderBottom: '1px solid var(--border-subtle)', fontWeight: 700, fontSize: '13px' }}>
            Customer Conversations ({threads.length})
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {threads.map((t) => {
              const isSelected = selectedThread?.customer_id === t.customer_id;
              return (
                <div
                  key={t.customer_id}
                  onClick={() => setSelectedThread(t)}
                  style={{
                    padding: '12px 14px',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: isSelected ? 'rgba(242, 107, 58, 0.12)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--accent-primary)' : '3px solid transparent',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 700, color: '#fff', fontSize: '13px' }}>
                      {t.customer_name}
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      {formatDate(t.last_at)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                    {t.channel === 'whatsapp' ? (
                      <MessageSquare size={12} color="#10b981" />
                    ) : (
                      <Mail size={12} color="#60a5fa" />
                    )}
                    <span style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {t.last_body}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Active Conversation Feed */}
        {selectedThread ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
            {/* Conversation Header */}
            <div style={{
              padding: '12px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '15px', color: '#fff' }}>
                  {selectedThread.customer_name}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '8px' }}>
                  <span>Preferred: <strong style={{ color: 'var(--accent-primary)' }}>{selectedThread.preferred_channel?.toUpperCase()}</strong></span>
                  <span>&bull;</span>
                  <span>Consent: Active On File</span>
                </div>
              </div>

              {/* Channel Selector */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => setChannel('whatsapp')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: channel === 'whatsapp' ? '#10b981' : 'var(--bg-secondary)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <MessageSquare size={13} />
                  <span>WhatsApp</span>
                </button>
                <button
                  onClick={() => setChannel('email')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: channel === 'email' ? 'var(--accent-indigo)' : 'var(--bg-secondary)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Mail size={13} />
                  <span>Email</span>
                </button>
              </div>
            </div>

            {/* Bubble Messages Stream */}
            <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {messages.map((m) => {
                const isOutbound = m.direction === 'outbound';
                return (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: isOutbound ? 'flex-end' : 'flex-start',
                      maxWidth: '75%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isOutbound ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      background: isOutbound
                        ? (m.channel === 'whatsapp' ? '#064e3b' : '#1e1b4b')
                        : 'var(--bg-surface)',
                      border: '1px solid ' + (isOutbound ? 'rgba(255,255,255,0.1)' : 'var(--border-subtle)'),
                      color: '#fff',
                      fontSize: '13px',
                      lineHeight: '1.4',
                      boxShadow: 'var(--shadow-sm)',
                    }}>
                      {m.subject && (
                        <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '4px', color: 'var(--accent-primary)' }}>
                          Subject: {m.subject}
                        </div>
                      )}
                      <div>{m.body}</div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>
                      <span>{formatDateTime(m.created_at)}</span>
                      {isOutbound && (
                        <>
                          <span>&bull;</span>
                          <span style={{ color: m.status === 'read' ? '#38bdf8' : m.status === 'delivered' ? '#34d399' : 'var(--text-muted)' }}>
                            {m.status === 'read' ? '✓✓ Read' : m.status === 'delivered' ? '✓✓ Delivered' : m.status}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer Footer */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
              {/* Quick Template Picker */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Templates:</span>
                {templates.map((tpl) => (
                  <button
                    key={tpl.key}
                    onClick={() => handleApplyTemplate(tpl.key)}
                    style={{
                      padding: '3px 8px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-full)',
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '10px' }}>
                <input
                  id="comms-reply-input"
                  type="text"
                  className="input-field"
                  placeholder={`Write a ${channel.toUpperCase()} reply to ${selectedThread.customer_name}...`}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  id="comms-send-btn"
                  type="submit"
                  className="btn btn-primary"
                  disabled={!replyText.trim()}
                >
                  <Send size={15} />
                  <span>Send</span>
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            Select a customer conversation to open the thread.
          </div>
        )}
      </div>
    </div>
  );
}
