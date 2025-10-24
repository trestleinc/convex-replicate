import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import './index.css';

function App() {
  const [documentId, setDocumentId] = useState('test-doc-1');
  const [message, setMessage] = useState('Hello from storage!');
  const [lastModified, setLastModified] = useState(0);

  const submitSnapshot = useMutation(api.storageTests.submitTestSnapshot);
  const submitChange = useMutation(api.storageTests.submitTestChange);
  const pullChanges = useQuery(api.storageTests.pullTestChanges, { lastModified });
  const metadata = useQuery(api.storageTests.getTestMetadata, { documentId });
  const changeStream = useQuery(api.storageTests.getChangeStream);

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>ConvexRx Storage Component Test</h1>

      <div
        style={{
          marginTop: '2rem',
          padding: '1rem',
          border: '1px solid #ccc',
          borderRadius: '8px',
        }}
      >
        <h2>Submit Data</h2>
        <div style={{ marginBottom: '1rem' }}>
          <label>
            Document ID:
            <input
              type="text"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              style={{ marginLeft: '1rem', padding: '0.5rem', width: '200px' }}
            />
          </label>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>
            Message:
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{ marginLeft: '1rem', padding: '0.5rem', width: '300px' }}
            />
          </label>
        </div>
        <div>
          <button
            type="button"
            onClick={() => submitSnapshot({ documentId, message })}
            style={{ marginRight: '1rem', padding: '0.5rem 1rem' }}
          >
            Submit Snapshot
          </button>
          <button
            type="button"
            onClick={() => submitChange({ documentId, message })}
            style={{ padding: '0.5rem 1rem' }}
          >
            Submit Change
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: '2rem',
          padding: '1rem',
          border: '1px solid #ccc',
          borderRadius: '8px',
        }}
      >
        <h2>Change Stream Stats</h2>
        {changeStream && (
          <div>
            <p>Latest Timestamp: {new Date(changeStream.timestamp).toLocaleString()}</p>
            <p>Total Documents: {changeStream.count}</p>
            <p>Total Size: {changeStream.totalSize} bytes</p>
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: '2rem',
          padding: '1rem',
          border: '1px solid #ccc',
          borderRadius: '8px',
        }}
      >
        <h2>Document Metadata: {documentId}</h2>
        {metadata ? (
          <div>
            <p>Snapshots: {metadata.snapshotCount}</p>
            <p>Changes: {metadata.changeCount}</p>
            {metadata.latestSnapshot && (
              <p>
                Latest Snapshot: {new Date(metadata.latestSnapshot.timestamp).toLocaleString()} (
                {metadata.latestSnapshot.size} bytes)
              </p>
            )}
            {metadata.latestChange && (
              <p>
                Latest Change: {new Date(metadata.latestChange.timestamp).toLocaleString()} (
                {metadata.latestChange.size} bytes)
              </p>
            )}
          </div>
        ) : (
          <p>No data found</p>
        )}
      </div>

      <div
        style={{
          marginTop: '2rem',
          padding: '1rem',
          border: '1px solid #ccc',
          borderRadius: '8px',
        }}
      >
        <h2>Pull Changes</h2>
        <div style={{ marginBottom: '1rem' }}>
          <label>
            Last Modified:
            <input
              type="number"
              value={lastModified}
              onChange={(e) => setLastModified(Number(e.target.value))}
              style={{ marginLeft: '1rem', padding: '0.5rem', width: '200px' }}
            />
          </label>
          <button
            type="button"
            onClick={() => pullChanges && setLastModified(pullChanges.checkpoint.lastModified)}
            style={{ marginLeft: '1rem', padding: '0.5rem 1rem' }}
          >
            Update Checkpoint
          </button>
        </div>
        {pullChanges && (
          <div>
            <p>Found {pullChanges.changes.length} changes</p>
            <p>Has More: {pullChanges.hasMore ? 'Yes' : 'No'}</p>
            <div style={{ marginTop: '1rem' }}>
              {pullChanges.changes.map((change) => (
                <div
                  key={`${change.documentId}-${change.timestamp}`}
                  style={{
                    padding: '0.5rem',
                    marginBottom: '0.5rem',
                    background: '#f5f5f5',
                    borderRadius: '4px',
                  }}
                >
                  <strong>{change.type}:</strong> {change.documentId}
                  <br />
                  <span>Message: {change.message}</span>
                  <br />
                  <span style={{ fontSize: '0.9em', color: '#666' }}>
                    {new Date(change.timestamp).toLocaleString()} - {change.size} bytes
                  </span>
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
