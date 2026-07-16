import { context } from '@devvit/web/client';
import { parseSharedStatePostData } from '../shared/sharedState';

export const loadSharedPostData = async () => {
  const contextual = parseSharedStatePostData(context.postData);

  if (contextual) {
    return contextual;
  }

  const localShareId = new URLSearchParams(window.location.search).get(
    'localShare'
  );

  if (!localShareId) {
    return null;
  }

  const response = await fetch(
    `/api/local-shares/${encodeURIComponent(localShareId)}`
  );

  if (!response.ok) {
    return null;
  }

  return parseSharedStatePostData(await response.json());
};
