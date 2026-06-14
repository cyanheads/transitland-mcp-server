/**
 * @fileoverview Barrel collecting all resource definitions for createApp().
 * @module mcp-server/resources/definitions/index
 */

import { feedResource } from './feed.resource.js';
import { operatorResource } from './operator.resource.js';

export const allResourceDefinitions = [operatorResource, feedResource];
