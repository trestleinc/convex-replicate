import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import './index.css';

function App() {
  const [documentId, setDocumentId] = useState('test-doc-1');
  const [message, setMessage] = useState('Hello from Convex Replicate!');
  const [version, setVersion] = useState(1);
  const [lastModified, setLastModified] = useState(0);

  const submitDocument = useMutation(api.storageTests.submitTestDocument);
  const pullChanges = useQuery(api.storageTests.pullTestChanges, { lastModified });
  const metadata = useQuery(api.storageTests.getTestMetadata, { documentId });
  const changeStream = useQuery(api.storageTests.getChangeStream);

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="hidden text-3xl text-center mb-8">Convex Replicate Component Test</h1>

      <div className="p-4 border border-rose-pine-muted rounded">
        <h2 className="text-2xl mb-4">Submit Document</h2>
        <div className="mb-4">
          <label className="flex items-center gap-4">
            <span className="font-semibold min-w-32">Document ID:</span>
            <input
              type="text"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              className="px-3 py-2 border border-rose-pine-muted rounded focus:outline-none focus:border-rose-pine-rose w-64"
            />
          </label>
        </div>
        <div className="mb-4">
          <label className="flex items-center gap-4">
            <span className="font-semibold min-w-32">Message:</span>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="px-3 py-2 border border-rose-pine-muted rounded focus:outline-none focus:border-rose-pine-rose flex-1"
            />
          </label>
        </div>
        <div className="mb-4">
          <label className="flex items-center gap-4">
            <span className="font-semibold min-w-32">Version:</span>
            <input
              type="number"
              value={version}
              onChange={(e) => setVersion(Number(e.target.value))}
              className="px-3 py-2 border border-rose-pine-muted rounded focus:outline-none focus:border-rose-pine-rose w-32"
            />
          </label>
        </div>
        <div>
          <button
            type="button"
            onClick={() => submitDocument({ documentId, message, version })}
            className="px-4 py-2 border border-rose-pine-rose text-rose-pine-text rounded hover:bg-rose-pine-rose hover:text-rose-pine-base transition-colors"
          >
            Submit Document
          </button>
        </div>
      </div>

      <div className="mt-2 p-4 border border-rose-pine-muted rounded">
        <h2 className="text-2xl mb-4">Change Stream Stats</h2>
        {changeStream ? (
          <div className="space-y-2">
            <p className="text-rose-pine-text">
              <span className="font-semibold">Latest Timestamp:</span>{' '}
              {new Date(changeStream.timestamp).toLocaleString()}
            </p>
            <p className="text-rose-pine-text">
              <span className="font-semibold">Total Documents:</span> {changeStream.count}
            </p>
          </div>
        ) : (
          <p className="text-rose-pine-muted">Loading...</p>
        )}
      </div>

      <div className="mt-2 p-4 border border-rose-pine-muted rounded">
        <h2 className="text-2xl mb-4">Document Metadata: {documentId}</h2>
        {metadata ? (
          <div className="space-y-2">
            <p className="text-rose-pine-text">
              <span className="font-semibold">Version:</span> {metadata.version}
            </p>
            <p className="text-rose-pine-text">
              <span className="font-semibold">Timestamp:</span>{' '}
              {new Date(metadata.timestamp).toLocaleString()}
            </p>
            <p className="text-rose-pine-text">
              <span className="font-semibold">Message:</span> {metadata.document.message}
            </p>
          </div>
        ) : (
          <p className="text-rose-pine-muted">No data found</p>
        )}
      </div>

      <div className="mt-2 p-4 border border-rose-pine-muted rounded">
        <h2 className="text-2xl mb-4">Pull Changes</h2>
        <div className="mb-4 flex items-center gap-4">
          <label className="flex items-center gap-4">
            <span className="font-semibold">Last Modified:</span>
            <input
              type="number"
              value={lastModified}
              onChange={(e) => setLastModified(Number(e.target.value))}
              className="px-3 py-2 border border-rose-pine-muted rounded focus:outline-none focus:border-rose-pine-rose w-48"
            />
          </label>
          <button
            type="button"
            onClick={() => pullChanges && setLastModified(pullChanges.checkpoint.lastModified)}
            className="px-4 py-2 border border-rose-pine-rose text-rose-pine-text rounded hover:bg-rose-pine-rose hover:text-rose-pine-base transition-colors"
          >
            Update Checkpoint
          </button>
        </div>
        {pullChanges && (
          <div className="space-y-2">
            <p className="text-rose-pine-text">Found {pullChanges.changes.length} changes</p>
            <p className="text-rose-pine-text">Has More: {pullChanges.hasMore ? 'Yes' : 'No'}</p>
            <div className="mt-4 space-y-2">
              {pullChanges.changes.map((change) => (
                <div
                  key={`${change.documentId}-${change.timestamp}`}
                  className="p-3 border border-rose-pine-muted rounded bg-rose-pine-surface"
                >
                  <p className="text-rose-pine-text">
                    <strong>Document:</strong> {change.documentId}
                  </p>
                  <p className="text-rose-pine-text">Message: {change.document.message}</p>
                  <p className="text-rose-pine-text">Version: {change.version}</p>
                  <p className="text-sm text-rose-pine-muted">
                    {new Date(change.timestamp).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
