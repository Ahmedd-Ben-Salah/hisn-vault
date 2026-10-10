import { Client, PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction, AccountId } from "@hashgraph/sdk";
import { need } from "./env";

export function hederaClient(): Client {
  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(need("RELAYER_ACCOUNT_ID")), PrivateKey.fromStringECDSA(need("RELAYER_PRIVATE_KEY").replace(/^0x/, "")));
  return client;
}

export async function createTopic(memo: string): Promise<string> {
  const client = hederaClient();
  const tx = await new TopicCreateTransaction().setTopicMemo(memo).execute(client);
  const receipt = await tx.getReceipt(client);
  client.close();
  return receipt.topicId!.toString();
}

export async function submit(topicId: string, message: string): Promise<string> {
  const client = hederaClient();
  const tx = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message).execute(client);
  await tx.getReceipt(client);
  client.close();
  return tx.transactionId.toString();
}
