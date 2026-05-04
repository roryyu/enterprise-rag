import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full space-y-8 text-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">企业知识库问答系统</h1>
          <p className="mt-2 text-gray-500">Enterprise RAG Knowledge Base</p>
        </div>
        <div className="space-y-4">
          <Link
            href="/chat"
            className="block w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700"
          >
            开始问答
          </Link>
          <Link
            href="/documents"
            className="block w-full bg-white border py-3 px-6 rounded-lg font-medium text-gray-700 hover:bg-gray-50"
          >
            文档管理
          </Link>
        </div>
      </div>
    </div>
  );
}
