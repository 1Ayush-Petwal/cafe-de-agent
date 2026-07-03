import { useCallback, useEffect, useState } from 'react';
import { AgentTurnDto, AgentWorkflowDto, ApiError, api } from '../api/client';

function turnLabel(turn: AgentTurnDto): string {
  if (turn.text) {
    return turn.text;
  }
  if (turn.functionCall) {
    return `Agent is checking: ${turn.functionCall.name.replace(/_/g, ' ')}…`;
  }
  if (turn.functionResponse) {
    return `${turn.functionResponse.name.replace(/_/g, ' ')} → done`;
  }
  return '';
}

/**
 * Screen 6 (PRD, pinned): agent chat with live progress and an approval
 * button. Progress arrives over SSE (issue #9) — any pushed event just
 * refetches the workflow, same "any message means refetch" convention as
 * the availability grid (issue #7), so the UI never tries to reconcile
 * partial state client-side.
 */
export function AgentChatPage() {
  const [message, setMessage] = useState('');
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<AgentWorkflowDto | null>(null);
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!workflowId) return;
    api.getAgentWorkflow(workflowId).then(setWorkflow).catch(() => undefined);
  }, [workflowId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!workflowId) return;
    return api.subscribeAgentWorkflow(workflowId, refresh);
  }, [workflowId, refresh]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setError(null);
    setSending(true);
    try {
      const result = await api.startAgentWorkflow(message.trim());
      setWorkflow(null);
      setWorkflowId(result.id);
      setMessage('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the agent');
    } finally {
      setSending(false);
    }
  };

  const handleApprove = async () => {
    if (!workflowId) return;
    setApproving(true);
    setError(null);
    try {
      await api.approveAgentWorkflow(workflowId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve');
    } finally {
      setApproving(false);
    }
  };

  const handleAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflowId || !answerText.trim()) return;
    setAnswering(true);
    setError(null);
    try {
      await api.answerAgentWorkflow(workflowId, answerText.trim());
      setAnswerText('');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send answer');
    } finally {
      setAnswering(false);
    }
  };

  return (
    <div className="agent-chat">
      <h1>Booking agent</h1>
      <p>Tell the agent what you want — e.g. &ldquo;book a table for 2 tonight&rdquo;.</p>

      <form onSubmit={handleSubmit}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Book a table for 2 tonight"
          disabled={sending}
        />
        <button type="submit" disabled={sending || !message.trim()}>
          {sending ? '…' : 'Send'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {workflow && (
        <div className="agent-conversation">
          <p className="agent-you">You: {workflow.request}</p>
          {workflow.history
            .filter((turn) => turn.role === 'model' || turn.functionResponse)
            .map((turn, i) => (
              <p key={i} className="agent-turn">
                {turnLabel(turn)}
              </p>
            ))}

          {workflow.status === 'awaiting_approval' && workflow.pendingAction && (
            <div className="agent-approval">
              <p>
                The agent wants to <strong>{workflow.pendingAction.name.replace(/_/g, ' ')}</strong> — this will
                spend money. Approve?
              </p>
              <button disabled={approving} onClick={handleApprove}>
                {approving ? '…' : 'Approve'}
              </button>
            </div>
          )}

          {workflow.status === 'awaiting_input' && workflow.pendingAction && (
            <form className="agent-answer" onSubmit={handleAnswer}>
              <p>{(workflow.pendingAction.args.question as string) ?? 'The agent needs more information.'}</p>
              <input
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="Your answer"
                disabled={answering}
              />
              <button type="submit" disabled={answering || !answerText.trim()}>
                {answering ? '…' : 'Send'}
              </button>
            </form>
          )}

          {workflow.status === 'done' && <p className="agent-done">Booking confirmed.</p>}
          {workflow.status === 'failed' && <p className="error">Agent failed: {workflow.failureReason}</p>}
        </div>
      )}
    </div>
  );
}
