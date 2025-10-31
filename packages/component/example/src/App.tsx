import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import './index.css';

function App() {
  const [documentId, setDocumentId] = useState('test-doc-1');
  const [message, setMessage] = useState('Hello from Convex Replicate!');
  const [lastModified, setLastModified] = useState(0);

  const insertDocument = useMutation(api.storageTests.insertTestDocument);
  const pullChanges = useQuery(api.storageTests.pullTestChanges, { lastModified });
  const changeStream = useQuery(api.storageTests.getChangeStream);

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="hidden text-3xl text-center mb-8">Convex Replicate Component Test</h1>

      <div className="p-4 border border-rose-pine-muted rounded">
        <h2 className="text-2xl mb-4">Insert Document</h2>
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
        <div>
          <button
            type="button"
            onClick={() => insertDocument({ documentId, message })}
            className="px-4 py-2 border border-rose-pine-rose text-rose-pine-text rounded hover:bg-rose-pine-rose hover:text-rose-pine-base transition-colors"
          >
            Insert Document
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
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl">Recent Changes</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setLastModified(0)}
              className="px-3 py-1 border border-rose-pine-muted text-rose-pine-text rounded hover:bg-rose-pine-muted transition-colors text-sm"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setLastModified(Date.now())}
              className="px-3 py-1 border border-rose-pine-muted text-rose-pine-text rounded hover:bg-rose-pine-muted transition-colors text-sm"
            >
              From Now
            </button>
          </div>
        </div>
        {pullChanges ? (
          <div className="space-y-2">
            <p className="text-rose-pine-muted text-sm">
              Showing changes since: {new Date(lastModified).toLocaleString()}
            </p>
            <p className="text-rose-pine-muted text-sm">
              {pullChanges.changes.length} changes found
              {pullChanges.hasMore && ' (more available)'}
            </p>
            <div className="space-y-2">
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
        ) : (
          <p className="text-rose-pine-muted">Loading...</p>
        )}
      </div>
    </div>
  );
}

export default App;
