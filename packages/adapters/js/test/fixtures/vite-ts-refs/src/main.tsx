import { App } from '@/App';
import { config } from '@config';
import { helper } from '~/helper';
import type { Props } from '@/types';

const lazy = () => import('@/Lazy');
export const boot = (p: Props) => [App, config, helper, lazy, p];
