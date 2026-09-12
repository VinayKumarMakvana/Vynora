import { Log } from '../models/Log';

export class ErrorAlertService {
  async logWorkflowError(body: any) {
    const s = (v: any) => (v === undefined || v === null) ? '' : String(v).trim();
    
    const wf = body.workflow || {};
    const ex = body.execution || {};
    const err = ex.error || body.error || {};
    const errNode = err.node || {};

    const workflow_name = s(wf.name) || 'Unknown workflow';
    const workflow_id = s(wf.id);
    const execution_id = s(ex.id) || s(body.id) || `exec-err-${Date.now()}`;
    const execution_url = s(ex.url);

    const failing_node = s(errNode.name) || s(ex.lastNodeExecuted) || 'Unknown node';

    let error_message = s(err.message) || s(err.description) || 'No error message provided';
    if (error_message.length > 800) error_message = error_message.slice(0, 800) + '…';

    const when = new Date();

    const newLog = await Log.create({
      execution_id: execution_id,
      workflow: workflow_name,
      entity_id: workflow_id || 'unknown_entity',
      action: 'workflow_error',
      result: 'Failed',
      error: `Node: ${failing_node} | ${error_message}`,
      severity: 'High',
      human_approval: false,
      event_id: execution_id,
      log_time: when
    } as any);

    return {
      status: 'success',
      message: 'Error logged successfully',
      log_id: newLog._id
    };
  }
}
