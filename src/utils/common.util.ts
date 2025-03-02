import fetch from 'node-fetch';
import {
  createMultisigThresholdPubkey,
  encodeAminoPubkey,
  Pubkey,
  pubkeyToAddress,
  SinglePubkey,
} from '@cosmjs/amino';
import { sha256 } from '@cosmjs/crypto';
import { toBech32, toHex } from '@cosmjs/encoding';
import {
  Fee,
  LCDClient,
  LegacyAminoMultisigPublicKey,
  MsgSend,
  MultiSignature,
  SignatureV2,
  SimplePublicKey,
} from '@terra-money/terra.js';
import { plainToInstance } from 'class-transformer';
import { readFile } from 'graceful-fs';
import {
  createMultisigThresholdPubkeyEvmos,
  encodeAminoPubkeySupportEvmos,
} from '../chains/evmos';
import { PUBKEY_TYPES } from '../common/constants/app.constant';
import { CustomError } from '../common/customError';
import { ErrorMap } from '../common/error.map';
import { UserInfo } from '../dtos/userInfo';
import { MultisigTransaction, Safe } from '../entities';
import { AuthService } from '../services/impls/auth.service';
import { ConfigService } from '../shared/services/config.service';

export class CommonUtil {
  private configService: ConfigService = new ConfigService();

  /**
   * Calculate address from public key
   * @param pubkey public key
   * @returns address string
   */
  public pubkeyToAddress(
    pubkey: Pubkey,
    prefix = this.configService.get('PREFIX'),
  ): string {
    if (prefix === 'evmos') {
      const pubkeyAmino = encodeAminoPubkeySupportEvmos(pubkey);
      console.log(toHex(pubkeyAmino));
      const rawAddress = sha256(pubkeyAmino).slice(0, 20);
      const address = toBech32(prefix, rawAddress);
      return address;
    } else {
      const pubkeyData = encodeAminoPubkey(pubkey);

      const rawAddress = sha256(pubkeyData).slice(0, 20);
      const address = toBech32(prefix, rawAddress);
      console.log(address);

      return pubkeyToAddress(pubkey, prefix);
    }
  }

  /**
   * https://stackoverflow.com/a/54974076/8461456
   * @param arr
   * @returns boolean
   */
  public checkIfDuplicateExists(arr): boolean {
    return new Set(arr).size !== arr.length;
  }

  /**
   *
   * @param strArr
   * @returns string[]
   */
  public filterEmptyInStringArray(strArr: string[]): string[] {
    return strArr.filter((e) => {
      return e !== '';
    });
  }

  createSafeAddressAndPubkey(
    pubKeyArrString: string[],
    threshold: number,
    prefix: string,
  ): {
    pubkey: string;
    address: string;
  } {
    let arrPubkeys;
    if (prefix === 'evmos') {
      arrPubkeys = pubKeyArrString.map(this.createPubkeyEvmos);
    } else arrPubkeys = pubKeyArrString.map(this.createPubkeys);

    let multisigPubkey;
    if (prefix === 'evmos') {
      multisigPubkey = createMultisigThresholdPubkeyEvmos(
        arrPubkeys,
        threshold,
      );
    } else {
      multisigPubkey = createMultisigThresholdPubkey(arrPubkeys, threshold);
    }
    const multiSigWalletAddress = this.pubkeyToAddress(multisigPubkey, prefix);
    return {
      pubkey: JSON.stringify(multisigPubkey),
      address: multiSigWalletAddress,
    };
  }

  private createPubkeyEvmos(value: string): SinglePubkey {
    const result: SinglePubkey = {
      type: 'ethermint/PubKeyEthSecp256k1',
      value: value,
    };
    return result;
  }

  private createPubkeys(value: string): SinglePubkey {
    const result: SinglePubkey = {
      type: 'tendermint/PubKeySecp256k1',
      value,
    };
    return result;
  }

  async makeTerraTx(
    multisigTransaction: MultisigTransaction,
    safe: Safe,
    multisigConfirmArr: any[],
    client: LCDClient,
  ) {
    const multisigPubkey = LegacyAminoMultisigPublicKey.fromAmino(
      JSON.parse(safe.safePubkey),
    );
    const multisig = new MultiSignature(multisigPubkey);

    const amount = {};
    amount[multisigTransaction.denom] = multisigTransaction.amount;
    const send = new MsgSend(
      multisigTransaction.fromAddress,
      multisigTransaction.toAddress,
      amount,
    );

    const tx = await client.tx.create(
      [
        {
          address: multisigTransaction.fromAddress,
          sequenceNumber: Number(multisigTransaction.sequence),
          publicKey: multisigPubkey,
        },
      ],
      {
        msgs: [send],
        fee: new Fee(
          multisigTransaction.gas,
          multisigTransaction.fee + multisigTransaction.denom,
        ),
        gas: multisigTransaction.gas.toString(),
      },
    );

    const addressSignarureMap = [];
    multisigConfirmArr.forEach((x) => {
      const pubkeyAmino: SimplePublicKey.Amino = {
        type: PUBKEY_TYPES.SECP256K1,
        value: x.pubkey,
      };
      const amino: SignatureV2.Amino = {
        signature: x.signature,
        pub_key: pubkeyAmino,
      };
      const sig = SignatureV2.fromAmino(amino);
      addressSignarureMap.push(sig);
    });

    multisig.appendSignatureV2s(addressSignarureMap);
    tx.appendSignatures([
      new SignatureV2(
        multisigPubkey,
        multisig.toSignatureDescriptor(),
        Number(multisigTransaction.sequence),
      ),
    ]);

    return tx;
  }

  getAuthInfo(): UserInfo {
    const currentUser = AuthService.getAuthUser();
    if (!currentUser) throw new CustomError(ErrorMap.UNAUTHRORIZED);
    return plainToInstance(UserInfo, currentUser);
  }

  jsonReader(filePath, cb) {
    readFile(filePath, 'utf-8', (error, fileData) => {
      if (error) {
        return cb && cb(error);
      }
      try {
        const object = JSON.parse(fileData);
        return cb && cb(null, object);
      } catch (error) {
        return cb && cb(error);
      }
    });
  }

  public async request(url: string, method = 'GET', body?: any) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (body) {
      options['body'] = JSON.stringify(body);
    }
    const result = await fetch(url, options);
    if (result.status !== 200) {
      throw new CustomError(
        ErrorMap.REQUEST_ERROR,
        `${new URL(url).host} ${result.status} ${result.statusText} `,
      );
    }
    return result.json();
  }

  getPercentage(number: any, sum: any): string {
    if (number == 0) {
      return '0';
    }
    return ((+number * 100) / sum).toFixed(2);
  }
}
