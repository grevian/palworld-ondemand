import { Port } from 'aws-cdk-lib/aws-ec2';
import { Protocol } from 'aws-cdk-lib/aws-ecs';
//import * as execa from 'execa';
import { constants } from './constants';
import { PalworldEditionConfig, StackConfig } from './types';

export const stringAsBoolean = (str?: string): boolean =>
  Boolean(str === 'true');

// export const isDockerInstalled = (): boolean => {
//   try {
//     execa.sync('docker', ['version']);
//     return true;
//   } catch (e) {
//     return false;
//   }
// };

export const getPalworldServerConfig = (): PalworldEditionConfig => {
  const palConfig = {
    image: constants.PALWORLD_DOCKER_IMAGE,
    queryPort: 27015,
    gamePort: 8211,
    protocol: Protocol.UDP,
    ingressRuleQueryPort: Port.udp(27015),
    ingressRuleGamePort: Port.udp(8211)
  };

  return palConfig;
};
