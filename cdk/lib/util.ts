import { Port } from 'aws-cdk-lib/aws-ec2';
import { Protocol } from 'aws-cdk-lib/aws-ecs';
import { constants } from './constants';
import { PalworldEditionConfig } from './types';

export const stringAsBoolean = (str?: string): boolean =>
  Boolean(str === 'true');

export const getPalworldServerConfig = (): PalworldEditionConfig => {
  const palConfig = {
    image: constants.PALWORLD_DOCKER_IMAGE,
    queryPort: 27015,
    gamePort: 8211,
    rconPort: 25575,
    protocol: Protocol.UDP,
    ingressRuleQueryPort: Port.udp(27015),
    ingressRuleGamePort: Port.udp(8211),
    ingressRuleRCONPort: Port.udp(25575)
  };

  return palConfig;
};
