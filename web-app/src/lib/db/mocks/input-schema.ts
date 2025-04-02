import {
  JobInputsDataSchemaType,
  ValidJobInputFormatValues,
  ValidJobInputTypes,
  ValidJobInputValidationTypes,
} from "@/lib/job-input";

export const inputSchemaMock: JobInputsDataSchemaType = {
  input_data: [
    {
      id: "text",
      name: "Hello Text",
      type: ValidJobInputTypes.NONE,
      data: {
        description: "Please Input fields to start job",
      },
    },
    {
      id: "reference-company",
      name: "Reference Company",
      type: ValidJobInputTypes.STRING,
      data: {
        placeholder: "Enter the reference company",
        description: "Which company should serve as basis",
      },
      validations: [
        {
          validation: ValidJobInputValidationTypes.MIN,
          value: 5,
        },
      ],
    },
    {
      id: "target-company",
      name: "Target Company",
      type: ValidJobInputTypes.STRING,
      data: {
        placeholder: "Enter the target company",
        description: "Which company should serve as target",
      },
      validations: [
        {
          validation: ValidJobInputValidationTypes.MIN,
          value: 5,
        },
      ],
    },
    {
      id: "timeout",
      name: "Timeout",
      type: ValidJobInputTypes.NUMBER,
      data: {
        placeholder: "Enter the timeout",
        description: "Timeout in seconds",
      },
      validations: [
        {
          validation: ValidJobInputValidationTypes.FORMAT,
          value: ValidJobInputFormatValues.INTEGER,
        },
      ],
    },
    {
      id: "categories",
      name: "Select Categories",
      type: ValidJobInputTypes.OPTION,
      data: {
        values: ["Speed", "Duration", "Cost", "Quality"],
        placeholder: "Select Categories",
        description: "Select Categories",
      },
      validations: [
        {
          validation: ValidJobInputValidationTypes.MAX,
          value: 3,
        },
      ],
    },
    {
      id: "period",
      name: "Select Period",
      type: ValidJobInputTypes.OPTION,
      data: {
        values: ["Last Year", "Last 3 Years", "Last 5 Years", "Last Decade"],
        placeholder: "Select Period",
        description: "Select Period",
      },
      validations: [
        {
          validation: ValidJobInputValidationTypes.MIN,
          value: 1,
        },
        {
          validation: ValidJobInputValidationTypes.MAX,
          value: 1,
        },
        {
          validation: ValidJobInputValidationTypes.OPTIONAL,
          value: "true",
        },
      ],
    },
    {
      id: "fast-check",
      name: "Fast Check",
      type: ValidJobInputTypes.BOOLEAN,
      data: {
        placeholder: "Fast check",
        description: "Fast check",
      },
      validations: [
        {
          validation: ValidJobInputValidationTypes.OPTIONAL,
          value: "true",
        },
      ],
    },
  ],
};
