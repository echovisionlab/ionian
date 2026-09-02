import { AssetEvents } from '@/lib/events/topics/asset';
import { TransitionEvents } from '@/lib/events/topics/transition';
import { DataTextureEvents } from './dataTexture';
import { GlobalEvents } from './global';
import { SimulationEvents } from './simulation';
import { MaterialTextureEvents } from './texture';

export type Events = GlobalEvents & SimulationEvents & DataTextureEvents & MaterialTextureEvents & TransitionEvents & AssetEvents;
