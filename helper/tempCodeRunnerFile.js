export const handleRequiresAction = async(data,IdleDeadline,threadId)=>{
    try {
        const toolOutputs =data.required_action.submit_tool_outputs.tool_calls.map((toolCall)=>{
            if(toolCall.function.name === 'get_file_data'){
                console.log(toolCall)
            }
        })
    } catch (error) {
        
    }

}