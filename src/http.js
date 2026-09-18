const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createLedgerHandler(service, { preview = false } = {}) {
  return async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      const host = req.headers.host || '';
      const base = new URL(`http://${host}`);
      if (!LOOPBACK.has(req.socket.remoteAddress) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) return send(403, { error: '统计接口仅允许本机宿主访问' });
      if (req.headers.origin && req.headers.origin !== base.origin) return send(403, { error: '不允许跨站请求' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: '不允许跨站请求' });
      const url = new URL(req.url, base);
      const root = url.searchParams.get('root');
      if (req.method === 'GET') {
        const projects = await service.listProjects();
        if (!root) return send(200, { projects: projects.map(p => ({ root: p.root, currentLines: p.currentLines })), preview });
        const project = await service.getProject(root, { refresh: url.searchParams.get('refresh') === '1' });
        if (!project) return send(404, { error: '当前项目尚未建立统计基线' });
        return send(200, { project, preview });
      }
      if (req.method === 'DELETE') {
        if (req.headers.origin !== base.origin || req.headers['x-ths-confirm'] !== 'clear-project-statistics') return send(403, { error: '需要明确确认清理统计' });
        if (!root || !await service.getProject(root)) return send(404, { error: '项目不存在' });
        await service.clearProject(root);
        return send(200, { cleared: true });
      }
      return send(405, { error: '不支持的请求方法' });
    } catch {
      return send(500, { error: '统计读取失败，请查看宿主日志' });
    }
  };
}
