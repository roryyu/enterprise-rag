'use client';

import { useState, useCallback } from 'react';

export default function DocumentUploader() {
  const [kbId, setKbId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<{ filename: string; status: string }[]>([]);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || !kbId) return;

      setUploading(true);
      const newResults: { filename: string; status: string }[] = [];

      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('kbId', kbId);

        try {
          const res = await fetch('/api/documents', { method: 'POST', body: formData });
          const data = await res.json();

          if (res.status === 409) {
            newResults.push({ filename: file.name, status: '已存在(跳过)' });
          } else if (res.ok || res.status === 202) {
            newResults.push({ filename: file.name, status: '处理中' });
          } else {
            newResults.push({ filename: file.name, status: `失败: ${data.error}` });
          }
        } catch {
          newResults.push({ filename: file.name, status: '上传失败' });
        }
      }

      setResults((prev) => [...newResults, ...prev]);
      setUploading(false);
      e.target.value = '';
    },
    [kbId]
  );

  return (
    <div className="max-w-2xl mx-auto py-8 px-6">
      <h1 className="text-2xl font-semibold mb-6">文档管理</h1>

      <div className="bg-white rounded-lg border p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">知识库 ID</label>
          <input
            type="text"
            value={kbId}
            onChange={(e) => setKbId(e.target.value)}
            placeholder="输入知识库 UUID"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">上传文档</label>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.md"
            onChange={handleUpload}
            disabled={!kbId || uploading}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          <p className="mt-1 text-xs text-gray-400">
            支持 PDF、Word、Excel、TXT、Markdown
          </p>
        </div>
      </div>

      {results.length > 0 && (
        <div className="mt-6 bg-white rounded-lg border">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-medium">上传结果</h2>
          </div>
          <ul className="divide-y">
            {results.map((r, i) => (
              <li key={i} className="px-4 py-2 flex justify-between text-sm">
                <span>{r.filename}</span>
                <span
                  className={
                    r.status === '处理中'
                      ? 'text-blue-600'
                      : r.status.includes('失败')
                        ? 'text-red-600'
                        : 'text-gray-500'
                  }
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
