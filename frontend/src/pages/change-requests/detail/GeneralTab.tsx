import SplitPane from '@/components/SplitPane';
import { type ChangeRequest } from '../changeRequestMeta';
import ContentPanel from './ContentPanel';
import StagePanel from './StagePanel';

/**
 * The change's working screen: its content on the left (editable at every
 * stage), the selected stage's own fields on the right. The pipeline above
 * picks the stage; the divider between the two columns can be dragged.
 */
export default function GeneralTab({ cr, stage }: { cr: ChangeRequest; stage: string }) {
  return (
    <SplitPane
      storageKey="cr-stage-pane-width"
      left={<ContentPanel cr={cr} />}
      right={<StagePanel key={stage} cr={cr} stage={stage} />}
    />
  );
}
