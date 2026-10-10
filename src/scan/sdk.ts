// SDK clients whose method calls are external writes: how each is constructed and the resource it implies.
// `report` proposes a `match` of the constructor text, so these calls are declared on day one.

export type Sdk = {
	/** Resource name: external.<name>. */
	name: string;
	/** Constructor text, also the proposed `match` entry. */
	ctor: string;
	/** Package the constructor must be imported from; null when the class name is specific enough. */
	module: RegExp | null;
	/** Variable names that are this client even when bound in another file. */
	receivers: RegExp;
};

export const SDKS: Sdk[] = [
	{ name: "stripe", ctor: "new Stripe(", module: null, receivers: /^stripe(?:client)?$/i },
	{ name: "resend", ctor: "new Resend(", module: null, receivers: /^resend(?:client)?$/i },
	{ name: "openai", ctor: "new OpenAI(", module: null, receivers: /^openai(?:client)?$/i },
	{
		name: "supabase",
		ctor: "createClient(",
		module: /^@supabase\/supabase-js$/,
		receivers: /^supabase(?:client|admin)?$/i,
	},
	{ name: "s3", ctor: "new S3Client(", module: /^@aws-sdk\/client-s3$/, receivers: /^s3(?:client)?$/i },
];

/** The SDK whose constructor text is `ctor`, if any. */
export const sdkFor = (ctor: string): Sdk | undefined => SDKS.find((s) => s.ctor === ctor);

/** Methods that read: not reported. Everything else on a client is an external write. */
export const SDK_READ =
	/^(?:retrieve|get|list|search|find|fetch|head|describe|count|exists|download|read|select|construct|parse|on|off|to)/;
