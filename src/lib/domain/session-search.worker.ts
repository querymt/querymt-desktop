import { SessionSearchIndex, type SessionSearchRequest, type SessionSearchResponse } from './session-search';

const index = new SessionSearchIndex();
const scope = self as unknown as {
  onmessage: (event: MessageEvent<SessionSearchRequest>) => void;
  postMessage: (response: SessionSearchResponse) => void;
};
scope.onmessage = ({ data }) => {
  if (data.type === 'patch') index.apply(data.patch);
  else scope.postMessage({ id: data.id, matches: index.search(data.query) });
};
